import { ReactNode } from 'react';
import { Card, CardHeader } from '../../components/ui/Card';

export function PlaceholderPage({ title, description, icon }: { title: string, description: string, icon: string }) {
  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="font-display text-display text-on-surface">{title}</h1>
          <p className="text-body-md text-outline mt-1">{description}</p>
        </div>
      </div>
      <Card>
        <div className="p-16 flex flex-col items-center justify-center text-center">
          <span className="material-symbols-outlined text-6xl text-outline mb-4 opacity-30">{icon}</span>
          <h3 className="font-headline-md text-on-surface mb-2">Under Construction</h3>
          <p className="text-body-md text-outline max-w-md">This view is currently being implemented. Check back soon for the full functionality.</p>
        </div>
      </Card>
    </div>
  );
}
