import { Workspace } from '@/components/notebook/workspace';

export default async function NotebookPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <Workspace notebookId={id} />;
}
