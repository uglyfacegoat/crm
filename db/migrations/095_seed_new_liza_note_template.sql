CREATE FUNCTION seed_liza_note_template() RETURNS trigger AS $$
BEGIN
  IF NEW.display_name ILIKE 'Лиза%' THEN
    INSERT INTO personal_note_templates (owner_organization_id, owner_member_id, name, body, template_kind)
    SELECT NEW.organization_id, NEW.id, 'Объект и стоимость',
      E'Название объекта: {{object}}\nПлощадь объекта: \nНаименование услуг: \nЦена за кВ.м.: \nОбщий чек: \nОбслуживание: ',
      'liza_order'
    WHERE NOT EXISTS (
      SELECT 1 FROM personal_note_templates
      WHERE owner_organization_id = NEW.organization_id AND owner_member_id = NEW.id
        AND template_kind = 'liza_order'
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER organization_members_seed_liza_note_template
AFTER INSERT OR UPDATE OF display_name ON organization_members
FOR EACH ROW EXECUTE FUNCTION seed_liza_note_template();
