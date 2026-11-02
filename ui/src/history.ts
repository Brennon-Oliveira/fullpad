import type { ClosedTab } from "./api";

/** "hoje 14:32", "ontem 09:10", "12/03 18:00" (ou com o ano, se for de outro ano). */
export function whenLabel(closedAtSecs: number, now = new Date()): string {
  const d = new Date(closedAtSecs * 1000);
  const hm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  const day = (x: Date) => Math.floor(new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime() / 86_400_000);
  const diff = day(now) - day(d);
  if (diff === 0) return `hoje ${hm}`;
  if (diff === 1) return `ontem ${hm}`;
  const date = `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
  return d.getFullYear() === now.getFullYear() ? `${date} ${hm}` : `${date}/${d.getFullYear()} ${hm}`;
}

/** Filtra pelo título ou caminho, sem diferenciar maiúsculas. */
export function filterClosed(list: ClosedTab[], query: string): ClosedTab[] {
  const q = query.trim().toLowerCase();
  if (!q) return list;
  return list.filter((c) => `${c.tab.title} ${c.tab.path ?? ""}`.toLowerCase().includes(q));
}

/** Janelinha com as abas fechadas (a mais recente primeiro): clicar ou Enter reabre. */
export function openHistory(list: ClosedTab[], onPick: (id: string) => void) {
  const back = document.createElement("div");
  back.className = "modal-backdrop";
  const box = document.createElement("div");
  box.className = "modal";
  box.role = "dialog";
  const title = document.createElement("div");
  title.className = "modal-title";
  title.textContent = "Histórico de abas fechadas";
  const input = document.createElement("input");
  input.className = "modal-search";
  input.placeholder = "Filtrar por nome ou caminho…";
  const ul = document.createElement("div");
  ul.className = "modal-list";
  box.append(title, input, ul);
  back.append(box);
  document.body.append(back);

  let shown: ClosedTab[] = [];
  let sel = 0;
  const close = () => {
    back.remove();
    document.removeEventListener("keydown", onKey, true);
  };
  const pick = (c: ClosedTab | undefined) => {
    if (!c) return;
    close();
    onPick(c.tab.id);
  };
  const render = () => {
    shown = filterClosed(list, input.value);
    sel = Math.min(sel, Math.max(0, shown.length - 1));
    if (shown.length === 0) {
      const empty = document.createElement("div");
      empty.className = "modal-empty";
      empty.textContent = list.length === 0 ? "Nenhuma aba fechada ainda." : "Nada encontrado.";
      ul.replaceChildren(empty);
      return;
    }
    ul.replaceChildren(
      ...shown.map((c, i) => {
        const row = document.createElement("div");
        row.className = "modal-row" + (i === sel ? " sel" : "");
        const name = document.createElement("span");
        name.className = "modal-name";
        name.textContent = c.tab.title || "Nova nota";
        const meta = document.createElement("span");
        meta.className = "modal-meta";
        meta.textContent = `${c.tab.path ? c.tab.path + " · " : ""}${whenLabel(c.closed_at)}`;
        row.append(name, meta);
        row.addEventListener("click", () => pick(c));
        return row;
      }),
    );
    ul.querySelector(".sel")?.scrollIntoView({ block: "nearest" });
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") (e.preventDefault(), close());
    else if (e.key === "Enter") (e.preventDefault(), pick(shown[sel]));
    else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      sel = Math.max(0, Math.min(shown.length - 1, sel + (e.key === "ArrowDown" ? 1 : -1)));
      render();
    }
  };
  input.addEventListener("input", () => ((sel = 0), render()));
  back.addEventListener("mousedown", (e) => e.target === back && close());
  document.addEventListener("keydown", onKey, true);
  render();
  input.focus();
}
