ALTER TABLE personal_note_templates
  ADD COLUMN template_kind text NOT NULL DEFAULT 'plain'
  CHECK (template_kind IN ('plain', 'liza_order'));

INSERT INTO personal_note_templates (owner_organization_id, owner_member_id, name, body, template_kind)
SELECT member.organization_id, member.id, 'Объект и стоимость',
  E'Название объекта: {{object}}\nПлощадь объекта: \nНаименование услуг: \nЦена за кВ.м.: \nОбщий чек: \nОбслуживание: ',
  'liza_order'
FROM organization_members AS member
WHERE member.display_name ILIKE 'Лиза%'
  AND NOT EXISTS (
    SELECT 1 FROM personal_note_templates AS template
    WHERE template.owner_organization_id = member.organization_id
      AND template.owner_member_id = member.id AND template.template_kind = 'liza_order'
  );
