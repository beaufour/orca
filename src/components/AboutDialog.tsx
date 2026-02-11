import { useState, useEffect } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { openUrl } from "@tauri-apps/plugin-opener";
import logoSrc from "../assets/logo.png";

interface AboutDialogProps {
  onClose: () => void;
}

export function AboutDialog({ onClose }: AboutDialogProps) {
  const [version, setVersion] = useState("");

  useEffect(() => {
    getVersion().then(setVersion);
  }, []);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-content about-dialog" onClick={(e) => e.stopPropagation()}>
        <img src={logoSrc} alt="Orca" className="about-logo" />
        <h3 className="about-title">Orca</h3>
        {version && <p className="about-version">v{version}</p>}
        <p className="about-desc">
          Manage parallel Claude Code sessions across repos and git worktrees.
        </p>
        <a
          className="about-link"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            openUrl("https://github.com/beaufour/orca");
          }}
        >
          github.com/beaufour/orca
        </a>
        <div className="about-hint">Press Esc to close</div>
      </div>
    </div>
  );
}
