interface ModalProps {
  onClose: () => void;
  className?: string;
  children: React.ReactNode;
}

export function Modal({ onClose, className = "modal-content", children }: ModalProps) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className={className} onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}
