import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { registerHooks } from "node:module";
import { mock, test } from "node:test";
import postgres from "postgres";
import { runMigrations } from "./migrate.mjs";

const adminUrl = process.env.MIGRATION_TEST_ADMIN_URL;
if (!adminUrl || process.env.CRM_TEST_FIXTURE_URL !== adminUrl) throw new Error("Run through the isolated PostgreSQL fixture.");
const root = new URL("../src/", import.meta.url);
const hooks = registerHooks({ resolve(specifier, context, nextResolve) {
  if (context.parentURL?.startsWith(root.href)) {
    if (specifier.startsWith("@/")) return nextResolve(new URL(`${specifier.slice(2)}${/\.(ts|mjs)$/.test(specifier) ? "" : ".ts"}`, root).href, context);
    if (specifier.startsWith(".") && !/\.(ts|mjs)$/.test(specifier)) return nextResolve(`${specifier}.ts`, context);
  }
  return nextResolve(specifier, context);
} });
let sql;
mock.module("server-only", { namedExports: {} });
mock.module(new URL("server/database.ts", root), { namedExports: { getDatabase: () => sql } });
const { listDocumentPage, getDocumentDetail, getDocumentArchiveTree, listDocumentFolders, getDocumentDownload, getDocumentVersionDownload, getDocumentBatchExport, moveArchiveItems, getDocumentVersionUploadTarget, setDocumentFavorite, DocumentNotFoundError } = await import("../src/server/documents/repository.ts");
const { documentListQuerySchema } = await import("../src/lib/document-list.ts");
const { AuthorizationError } = await import("../src/server/auth/permissions.ts");

test("complete document archive, direct details and download scope preserve the center principal", async t => {
  const admin = postgres(adminUrl, { max: 1, onnotice: () => {} });
  const databaseName = `crm_document_list_${randomUUID().replaceAll("-", "")}`;
  await admin`CREATE DATABASE ${admin(databaseName)}`;
  const url = new URL(adminUrl); url.pathname = `/${databaseName}`;
  sql = postgres(url.toString(), { max: 4, onnotice: () => {} });
  t.after(async () => { mock.restoreAll(); hooks.deregister(); await sql.end(); try { await admin`DROP DATABASE ${admin(databaseName)}`; } finally { await admin.end(); } });
  await runMigrations({ databaseUrl: url.toString(), onApplied: () => {} });
  const [center] = await sql`INSERT INTO organizations (name, organization_kind, timezone) VALUES ('Центр архива', 'center', 'Europe/Moscow') RETURNING id`;
  const [company] = await sql`INSERT INTO organizations (name, organization_kind, parent_organization_id, timezone)
    VALUES ('Компания архива', 'company', ${center.id}, 'Asia/Vladivostok') RETURNING id`;
  const [hidden] = await sql`INSERT INTO organizations (name,timezone) VALUES ('Скрытая компания','Europe/Moscow') RETURNING id`;
  async function seedAccount(organizationId, email) {
    const [member] = await sql`INSERT INTO organization_members (organization_id, display_name, email, role) VALUES (${organizationId}, 'Автор архива', ${email}, 'admin') RETURNING id`;
    const [client] = await sql`INSERT INTO clients (organization_id, legal_name, kind) VALUES (${organizationId}, 'Заказчик архива', 'legal_entity') RETURNING id`;
    const [order] = await sql`INSERT INTO orders (organization_id, client_id, order_number, status, currency, client_name_snapshot, object_name_snapshot, object_address_snapshot)
      VALUES (${organizationId}, ${client.id}, 'АРХИВ-101', 'new', 'RUB', 'Заказчик архива', 'Без объекта', '') RETURNING id`;
    return { memberId: member.id, clientId: client.id, orderId: order.id, organizationId, role: 'owner', permissionOverrides: {} };
  }
  const principal = await seedAccount(center.id, 'center@archive.invalid');
  const target = await seedAccount(company.id, 'target@archive.invalid');
  const secret = await seedAccount(hidden.id, 'hidden@archive.invalid');
  const [session] = await sql`INSERT INTO auth_sessions (organization_id, member_id, token_hash, expires_at)
    VALUES (${center.id}, ${principal.memberId}, ${'b'.repeat(64)}, now() + interval '1 day') RETURNING id`;
  const reader = { ...principal, sessionId: session.id };
  await sql`INSERT INTO organization_access_grants (principal_organization_id, principal_member_id, target_organization_id, target_member_id)
    VALUES (${center.id}, ${principal.memberId}, ${company.id}, ${target.memberId})`;
  async function seedDocument(member, title, date='2027-01-01T00:00:00Z', size=100, category='contract') {
    const id=randomUUID();
    await sql`INSERT INTO documents (id, organization_id, client_id, order_id, title, category, created_by)
      VALUES (${id}, ${member.organizationId}, ${member.clientId}, ${member.orderId}, ${title}, ${category}, ${member.memberId})`;
    const [version]=await sql`INSERT INTO document_versions (organization_id, document_id, version_number, original_filename, storage_key, mime_type, extension, size_bytes, sha256, uploaded_by, created_at)
      VALUES (${member.organizationId}, ${id}, 1, ${title+'.pdf'}, ${member.organizationId+'/'+id+'/v1.pdf'}, 'application/pdf', 'pdf', ${size}, ${'a'.repeat(64)}, ${member.memberId}, ${date}) RETURNING id`;
    await sql`UPDATE documents SET current_version_id=${version.id} WHERE id=${id}`;
    return { id, versionId:version.id };
  }
  const own=await seedDocument(principal, 'Собственный документ');
  const blocked=await seedDocument(secret, 'Запрещенный документ');
  const docs=[];
  for (let i=1;i<=501;i++) docs.push(await seedDocument(target, 'Документ '+String(i).padStart(4,'0'), '2027-01-01T00:00:00Z', i));
  const late=await seedDocument(target, 'Янтарный документ Ёж', '2027-01-01T15:30:00Z', 777, 'act');
  const defaults=documentListQuerySchema.parse({});
  const ids=[];
  for (let page=1;page<=11;page++) {
    const result=await listDocumentPage(reader,{...defaults,page}); assert.equal(result.total,503);assert.equal(result.scopeTotal,503);assert.ok(result.items.length<=50);assert.ok(result.items.every(d=>d.versions.length===0),'history is loaded only for an opened document'); ids.push(...result.items.map(d=>d.id));
  }
  assert.equal(new Set(ids).size,503); assert.ok(ids.includes(late.id));assert.ok(!ids.includes(blocked.id));
  assert.equal((await listDocumentPage(reader,{...defaults,page:999})).page,11);
  assert.equal((await listDocumentPage(reader,{...defaults,q:'янтарный документ еж'})).items[0].id,late.id);
  assert.equal((await listDocumentPage(reader,{...defaults,q:'Компания архива'})).total,502);
  assert.equal((await listDocumentPage(reader,{...defaults,scope:'own'})).total,1);
  assert.equal((await listDocumentPage(reader,{...defaults,clientId:target.clientId})).total,502);
  assert.equal((await listDocumentPage(reader,{...defaults,objectId:target.orderId})).total,502,'orders without objects remain navigable');
  assert.equal((await listDocumentPage(reader,{...defaults,category:'act'})).total,1);
  assert.equal((await listDocumentPage(reader,{...defaults,dateFrom:'2027-01-02',dateTo:'2027-01-02'})).total,1,'upload date is filtered in the company timezone');
  assert.equal((await listDocumentPage(reader,{...defaults,sort:'size-desc'})).items[0].id,late.id);
  assert.equal((await listDocumentPage(reader,{...defaults,sort:'size-asc'})).items[0].id,docs[0].id);
  const [folder]=await sql`INSERT INTO document_folders (organization_id,name,created_by) VALUES (${company.id},'Поздняя папка',${target.memberId}) RETURNING id`;
  await sql`UPDATE documents SET folder_id=${folder.id} WHERE id=ANY(${docs.slice(0,51).map(d=>d.id)}::uuid[])`;
  assert.equal((await listDocumentPage(reader,{...defaults,folderId:folder.id})).total,51);
  assert.equal((await listDocumentPage(reader,{...defaults,rootOnly:true})).total,452);
  assert.equal((await listDocumentFolders(reader,true)).length,1);assert.equal((await listDocumentFolders(reader)).length,0);
  const tree=await getDocumentArchiveTree(reader,true);assert.equal(tree.documentCount,503);assert.ok(tree.clients.some(c=>c.organizationName==='Компания архива'));
  const [second]=await sql`INSERT INTO document_versions (organization_id,document_id,version_number,original_filename,storage_key,mime_type,extension,size_bytes,sha256,uploaded_by)
    VALUES (${company.id},${docs[500].id},2,'Новая версия.pdf',${company.id+'/'+docs[500].id+'/v2.pdf'},'application/pdf','pdf',222,${'c'.repeat(64)},${target.memberId}) RETURNING id`;
  await sql`UPDATE documents SET current_version_id=${second.id},version=2 WHERE id=${docs[500].id}`;
  const detail=await getDocumentDetail(reader,docs[500].id);assert.equal(detail.versions.length,2);assert.equal(detail.versionNumber,2);assert.equal(detail.organizationId,company.id);
  assert.equal((await getDocumentDownload(reader,docs[500].id)).id,second.id);
  assert.equal((await getDocumentVersionDownload(reader,docs[500].id,docs[500].versionId)).id,docs[500].versionId);
  assert.equal((await getDocumentBatchExport(reader,[own.id,docs[0].id,docs[500].id])).length,3);
  await assert.rejects(getDocumentBatchExport(reader,[own.id,blocked.id]),DocumentNotFoundError);
  await assert.rejects(getDocumentDetail(reader,blocked.id),DocumentNotFoundError);
  await assert.rejects(getDocumentVersionUploadTarget(reader,late.id,1),DocumentNotFoundError);
  await assert.rejects(moveArchiveItems(reader,{folderIds:[],documentIds:[late.id],targetFolderId:null}),DocumentNotFoundError);
  await assert.rejects(setDocumentFavorite(reader,late.id,true),DocumentNotFoundError);
  await setDocumentFavorite(reader,own.id,true);
  assert.equal((await listDocumentPage(reader,{...defaults,favorite:'favorite'})).total,1);
  await assert.rejects(listDocumentPage({...reader,role:'master'},defaults),AuthorizationError);
  const [unchanged]=await sql`SELECT active_organization_id FROM auth_sessions WHERE id=${session.id}`;assert.equal(unchanged.active_organization_id,null);
  await sql`DELETE FROM organization_access_grants WHERE principal_organization_id=${center.id}`;
  assert.equal((await listDocumentPage(reader,defaults)).total,1);assert.equal((await getDocumentArchiveTree(reader,true)).documentCount,1);
  await assert.rejects(getDocumentDetail(reader,late.id),DocumentNotFoundError);
  await assert.rejects(getDocumentDownload(reader,late.id),DocumentNotFoundError);
  await assert.rejects(getDocumentVersionDownload(reader,docs[500].id,docs[500].versionId),DocumentNotFoundError);
  await assert.rejects(getDocumentBatchExport(reader,[own.id,late.id]),DocumentNotFoundError);
});
