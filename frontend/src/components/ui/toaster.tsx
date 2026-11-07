import type { CSSProperties } from "react";
import { Toaster as Sonner } from "sonner";
import { useTheme } from "@/lib/theme";

/** Small confirmations in the corner: toast.success("Saved"), toast.error("Couldn't save: …"). Mounted once in main.tsx. */
export { toast } from "sonner";

export function Toaster() {
  const { resolved } = useTheme();
  return (
    <Sonner
      theme={resolved}
      position="bottom-right"
      closeButton
      offset={16}
      mobileOffset={{ bottom: 88 }}
      style={{
        "--normal-bg": "var(--popover)",
        "--normal-text": "var(--popover-foreground)",
        "--normal-border": "var(--border)",
        "--border-radius": "0.75rem",
      } as CSSProperties}
      toastOptions={{ classNames: { toast: "font-sans shadow-lg!", description: "text-muted-foreground!", actionButton: "bg-primary! text-primary-foreground!" } }}
    />
  );
}
