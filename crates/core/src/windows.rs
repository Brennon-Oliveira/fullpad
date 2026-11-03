//! Abas em várias janelas. Cada aba pertence a uma janela (`TabState::window`); a sessão guarda tudo
//! num único `session.json`, e cada janela só mexe nas próprias abas.

use crate::model::{Geometry, Session, TabState, WindowState, MAIN_WINDOW};
use std::collections::HashSet;
use uuid::Uuid;

impl Session {
    pub fn window_tabs(&self, label: &str) -> Vec<TabState> {
        self.tabs.iter().filter(|t| t.window == label).cloned().collect()
    }

    /// Aba ativa da janela (a salva, se ainda existir; senão a primeira).
    pub fn active_of(&self, label: &str) -> Option<Uuid> {
        let saved = if label == MAIN_WINDOW {
            self.active
        } else {
            self.windows.iter().find(|w| w.label == label).and_then(|w| w.active)
        };
        let mine = || self.tabs.iter().filter(|t| t.window == label);
        saved
            .filter(|id| mine().any(|t| t.id == *id))
            .or_else(|| mine().next().map(|t| t.id))
    }

    pub fn set_active(&mut self, label: &str, id: Option<Uuid>) {
        if label == MAIN_WINDOW {
            self.active = id;
        } else {
            self.window_state(label).active = id;
        }
    }

    fn window_state(&mut self, label: &str) -> &mut WindowState {
        if let Some(i) = self.windows.iter().position(|w| w.label == label) {
            return &mut self.windows[i];
        }
        self.windows.push(WindowState { label: label.to_string(), active: None, geometry: None, layout: None });
        self.windows.last_mut().unwrap()
    }

    pub fn set_geometry(&mut self, label: &str, g: Geometry) {
        if label != MAIN_WINDOW {
            self.window_state(label).geometry = Some(g);
        }
    }

    pub fn set_layout(&mut self, label: &str, layout: Option<serde_json::Value>) {
        if layout.is_some() || self.windows.iter().any(|w| w.label == label) {
            self.window_state(label).layout = layout;
        }
    }

    pub fn layout_of(&self, label: &str) -> Option<serde_json::Value> {
        self.windows.iter().find(|w| w.label == label).and_then(|w| w.layout.clone())
    }

    pub fn geometry_of(&self, label: &str) -> Option<Geometry> {
        self.windows.iter().find(|w| w.label == label).and_then(|w| w.geometry)
    }

    /// O que uma janela enxerga: só as abas dela, com a ativa dela em `active`.
    pub fn view_for(&self, label: &str) -> Session {
        Session {
            version: self.version,
            tabs: self.window_tabs(label),
            active: self.active_of(label),
            windows: Vec::new(),
        }
    }

    /// Janelas flutuantes que têm abas, na ordem em que aparecem.
    pub fn floating_labels(&self) -> Vec<String> {
        let mut out: Vec<String> = Vec::new();
        for t in &self.tabs {
            if t.window != MAIN_WINDOW && !out.contains(&t.window) {
                out.push(t.window.clone());
            }
        }
        out
    }

    /// Rótulo livre para uma janela nova.
    pub fn fresh_label(&self) -> String {
        (2..)
            .map(|n| format!("win-{n}"))
            .find(|l| !self.tabs.iter().any(|t| &t.window == l) && !self.windows.iter().any(|w| &w.label == l))
            .unwrap()
    }

    /// Grava o estado que a janela `label` enviou: as abas dela (na ordem dela) e a ativa.
    ///
    /// Só atualiza e reordena; **nunca remove** abas que a janela não mencionou, porque uma aba pode
    /// estar chegando de outra janela e ainda não ter sido vista por ela. Fechar uma aba é
    /// `remove_tab`. `closed` são abas já fechadas: uma gravação atrasada não pode ressuscitá-las. E uma
    /// aba que agora é de outra janela não é puxada de volta.
    pub fn apply_window(&mut self, label: &str, tabs: Vec<TabState>, active: Option<Uuid>, closed: &HashSet<Uuid>) {
        let mut accepted: Vec<TabState> = Vec::new();
        for mut t in tabs {
            if closed.contains(&t.id) {
                continue;
            }
            if let Some(stored) = self.tabs.iter().find(|s| s.id == t.id) {
                if stored.window != label {
                    continue;
                }
                // o tipo da aba não muda por gravação da UI: uma aba de PDF nunca vira texto editável
                t.kind = stored.kind;
            }
            t.window = label.to_string();
            accepted.push(t);
        }
        let ids: HashSet<Uuid> = accepted.iter().map(|t| t.id).collect();
        let (mine_rest, mut others): (Vec<TabState>, Vec<TabState>) = std::mem::take(&mut self.tabs)
            .into_iter()
            .filter(|t| !ids.contains(&t.id))
            .partition(|t| t.window == label);
        others.extend(accepted);
        others.extend(mine_rest);
        self.tabs = others;
        if let Some(a) = active {
            if self.tabs.iter().any(|t| t.id == a && t.window == label) {
                self.set_active(label, Some(a));
            }
        }
    }

    /// Passa a aba para a janela `to` (com o estado mais recente que quem a tinha conhece) e a torna
    /// a ativa de lá. Se era a ativa da janela de origem, a origem fica com a primeira que sobrar.
    pub fn move_tab(&mut self, mut tab: TabState, to: &str) {
        let from = self.tabs.iter().find(|t| t.id == tab.id).map(|t| t.window.clone());
        self.tabs.retain(|t| t.id != tab.id);
        tab.window = to.to_string();
        let id = tab.id;
        self.tabs.push(tab);
        self.set_active(to, Some(id));
        if let Some(from) = from {
            if from != to && self.active_of(&from) == Some(id) {
                let next = self.tabs.iter().find(|t| t.window == from).map(|t| t.id);
                self.set_active(&from, next);
            }
        }
    }

    pub fn remove_tab(&mut self, id: Uuid) {
        self.tabs.retain(|t| t.id != id);
    }

    /// Descarta o registro de janelas flutuantes que ficaram sem abas.
    pub fn prune_windows(&mut self) {
        let alive: HashSet<String> = self.tabs.iter().map(|t| t.window.clone()).collect();
        self.windows.retain(|w| alive.contains(&w.label));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tab(window: &str) -> TabState {
        let mut t = TabState::new(Uuid::new_v4());
        t.window = window.to_string();
        t
    }

    fn session(tabs: Vec<TabState>) -> Session {
        Session { version: 1, tabs, active: None, windows: vec![] }
    }

    #[test]
    fn old_session_without_window_field_puts_everything_in_main() {
        let id = Uuid::new_v4();
        let json = format!(r#"{{"version":1,"active":"{id}","tabs":[{{"id":"{id}","title":"x"}}]}}"#);
        let s: Session = serde_json::from_str(&json).unwrap();
        assert_eq!(s.tabs[0].window, MAIN_WINDOW);
        assert!(!s.tabs[0].detached);
        assert_eq!(s.view_for(MAIN_WINDOW).tabs.len(), 1);
        assert!(s.view_for("win-2").tabs.is_empty());
    }

    #[test]
    fn each_window_sees_only_its_own_tabs_and_active() {
        let (a, b, c) = (tab("main"), tab("win-2"), tab("win-2"));
        let mut s = session(vec![a.clone(), b.clone(), c.clone()]);
        s.set_active("win-2", Some(c.id));
        let v = s.view_for("win-2");
        assert_eq!(v.tabs.iter().map(|t| t.id).collect::<Vec<_>>(), vec![b.id, c.id]);
        assert_eq!(v.active, Some(c.id));
        assert_eq!(s.view_for("main").active, Some(a.id));
        assert_eq!(s.floating_labels(), vec!["win-2".to_string()]);
    }

    #[test]
    fn apply_window_reorders_updates_and_never_removes() {
        let (a, b, c) = (tab("main"), tab("main"), tab("main"));
        let other = tab("win-2");
        let mut s = session(vec![a.clone(), other.clone(), b.clone(), c.clone()]);
        let mut a2 = a.clone();
        a2.cursor = 7;
        // a janela só mandou c, a (reordenadas); b ainda não era conhecida por ela (chegando de fora)
        s.apply_window("main", vec![c.clone(), a2], Some(c.id), &HashSet::new());
        let main: Vec<Uuid> = s.window_tabs("main").iter().map(|t| t.id).collect();
        assert_eq!(main, vec![c.id, a.id, b.id], "b é mantida, no fim");
        assert_eq!(s.window_tabs("main")[1].cursor, 7);
        assert_eq!(s.window_tabs("win-2").len(), 1, "outra janela não é tocada");
        assert_eq!(s.active, Some(c.id));
    }

    #[test]
    fn save_window_cannot_change_the_kind_of_a_tab() {
        let mut pdf = tab("main");
        pdf.kind = crate::model::TabKind::Pdf;
        let mut s = session(vec![pdf.clone()]);
        let mut forged = pdf.clone();
        forged.kind = crate::model::TabKind::Text;
        forged.reader = Some(serde_json::json!({ "page": 3 }));
        s.apply_window("main", vec![forged], None, &HashSet::new());
        let got = &s.window_tabs("main")[0];
        assert_eq!(got.kind, crate::model::TabKind::Pdf);
        assert_eq!(got.reader, Some(serde_json::json!({ "page": 3 })), "a posição de leitura é atualizada");
    }

    #[test]
    fn stale_save_cannot_resurrect_closed_or_steal_moved_tabs() {
        let (a, b) = (tab("main"), tab("main"));
        let mut s = session(vec![a.clone(), b.clone()]);
        s.move_tab(b.clone(), "win-2");
        let closed: HashSet<Uuid> = [a.id].into_iter().collect();
        s.remove_tab(a.id);
        // gravação atrasada da principal, ainda com as duas
        s.apply_window("main", vec![a.clone(), b.clone()], None, &closed);
        assert!(s.window_tabs("main").is_empty());
        assert_eq!(s.window_tabs("win-2").len(), 1);
    }

    #[test]
    fn move_tab_updates_state_and_fixes_active_of_both_windows() {
        let (a, b) = (tab("main"), tab("main"));
        let mut s = session(vec![a.clone(), b.clone()]);
        s.active = Some(a.id);
        let mut moved = a.clone();
        moved.cursor = 42;
        s.move_tab(moved, "win-2");
        assert_eq!(s.window_tabs("win-2")[0].cursor, 42);
        assert_eq!(s.active_of("win-2"), Some(a.id));
        assert_eq!(s.active_of("main"), Some(b.id), "a origem fica com a que sobrou");
    }

    #[test]
    fn fresh_label_skips_labels_in_use_and_prune_drops_empty_windows() {
        let mut s = session(vec![tab("win-2"), tab("win-3")]);
        assert_eq!(s.fresh_label(), "win-4");
        s.set_active("win-9", None);
        s.set_geometry("win-2", Geometry { x: 1, y: 2, w: 300, h: 200 });
        s.prune_windows();
        assert_eq!(s.windows.len(), 1);
        assert_eq!(s.geometry_of("win-2").unwrap().w, 300);
    }

    #[test]
    fn layout_is_kept_per_window_and_old_sessions_have_none() {
        let mut s = session(vec![tab("main")]);
        assert_eq!(s.layout_of("main"), None);
        let l = serde_json::json!({"root": {"t": "leaf", "g": 0}});
        s.set_layout("main", Some(l.clone()));
        assert_eq!(s.layout_of("main"), Some(l));
        assert_eq!(s.layout_of("win-2"), None);
        let json = serde_json::to_string(&s).unwrap();
        let back: Session = serde_json::from_str(&json).unwrap();
        assert_eq!(back, s);
        s.prune_windows();
        assert!(s.layout_of("main").is_some(), "janela com abas mantém a grade");
    }
}
