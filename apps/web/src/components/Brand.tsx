export default function Brand() {
  return (
    <div className="flex items-center gap-2.5 whitespace-nowrap" dir="ltr">
      <img
        src="/tungsten-logo.png"
        alt="Tungsten Logo"
        className="size-9 rounded-full shadow-sm object-contain shrink-0"
      />

      <span className="text-lg font-semibold tracking-tight">
        Tungsten
        <span className="ms-1 text-muted">CRM</span>
      </span>
    </div>
  );
}
