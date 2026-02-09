interface ShortcutHelpProps {
  onClose: () => void;
}

const SHORTCUTS = [
  { key: "j / ↓", desc: "Move focus down" },
  { key: "k / ↑", desc: "Move focus up" },
  { key: "Enter", desc: "Open focused session terminal" },
  { key: "Esc", desc: "Close modal / clear search / unfocus" },
  { key: "d", desc: "Remove focused session" },
  { key: "x", desc: "Dismiss/undismiss needs input" },
  { key: "R", desc: "Rename focused session" },
  { key: "m", desc: "Move session to group" },
  { key: "g", desc: "Create new group" },
  { key: "i", desc: "New issue (in group view)" },
  { key: "n", desc: "New session" },
  { key: "/", desc: "Search sessions" },
  { key: "0", desc: "Needs Action" },
  { key: "1", desc: "All sessions" },
  { key: "2-9", desc: "Switch to group" },
  { key: "L", desc: "View app log" },
  { key: "Ctrl+Q", desc: "Close terminal" },
  { key: "?", desc: "Show this help" },
];

export function ShortcutHelp({ onClose }: ShortcutHelpProps) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <h3 className="modal-title">Keyboard Shortcuts</h3>
        <div className="shortcut-list">
          {SHORTCUTS.map(({ key, desc }) => (
            <div key={key} className="shortcut-row">
              <kbd className="shortcut-key">{key}</kbd>
              <span className="shortcut-desc">{desc}</span>
            </div>
          ))}
        </div>
        <div className="shortcut-hint">Press Esc or ? to close</div>
      </div>
    </div>
  );
}
