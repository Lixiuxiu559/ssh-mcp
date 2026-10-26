import { Dialog } from "@base-ui/react/dialog";
import { X } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "./button";
export function Modal({
  open,
  onOpenChange,
  title,
  description,
  children,
  wide = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className="dialog-backdrop" />
        <Dialog.Popup className={`dialog-popup ${wide ? "dialog-wide" : ""}`}>
          <div className="dialog-heading">
            <div>
              <Dialog.Title className="dialog-title">{title}</Dialog.Title>
              {description && (
                <Dialog.Description className="dialog-description">
                  {description}
                </Dialog.Description>
              )}
            </div>
            <Dialog.Close
              render={
                <Button
                  variant="quiet"
                  className="icon-button"
                  aria-label="关闭弹窗"
                />
              }
            >
              <X size={18} />
            </Dialog.Close>
          </div>
          <div className="dialog-body">{children}</div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
