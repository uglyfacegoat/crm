type PageHeadingProps = {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: React.ReactNode;
};

export function PageHeading({ eyebrow, title, description, action }: PageHeadingProps) {
  return (
    <header className="flex flex-col gap-5 min-[520px]:flex-row min-[520px]:items-end min-[520px]:justify-between">
      <div>
        {eyebrow ? <p className="eyebrow mb-2.5">{eyebrow}</p> : null}
        <h1 className="display-title text-white">{title}</h1>
        {description ? <p className="mt-2.5 max-w-3xl text-[clamp(0.82rem,0.78rem+0.12vw,0.96rem)] leading-6 text-[var(--muted)]">{description}</p> : null}
      </div>
      {action ? <div className="shrink-0 [&>*]:w-full min-[520px]:[&>*]:w-auto">{action}</div> : null}
    </header>
  );
}
