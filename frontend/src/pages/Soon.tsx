import { Hammer } from "lucide-react";
import { Card, EmptyState, PageHeader } from "../components/ui";

/** Pages whose screens are still being built. The API behind most of them already works. */
export default function Soon({ title, text }: { title: string; text: string }) {
  return (
    <>
      <PageHeader title={title} />
      <Card><EmptyState icon={<Hammer />} title="Being built next">{text}</EmptyState></Card>
    </>
  );
}
