import type { Metadata } from 'next';
import { NotebookHome } from '@/components/home/notebook-home';

export const metadata: Metadata = { title: 'Notebooks · Math Notebook' };

export default function NotebooksPage() {
  return <NotebookHome />;
}
