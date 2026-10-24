import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
      <h1 className="text-xl font-semibold">Page not found</h1>
      <Link href="/notebooks" className="text-accent underline underline-offset-2">
        Back to notebooks
      </Link>
    </div>
  );
}
