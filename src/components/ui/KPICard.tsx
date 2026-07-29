import { Card, CardContent } from './Card';

interface KPICardProps {
  title: string;
  value: string | number;
  icon: string;
  iconColorClass: string;
  trend?: string;
  trendColorClass?: string;
  trendIcon?: string;
  prefix?: string;
}

export function KPICard({ title, value, icon, iconColorClass, trend, trendColorClass, trendIcon, prefix }: KPICardProps) {
  return (
    <Card className="group hover:border-primary-container transition-colors">
      <CardContent className="p-6">
        <div className="flex justify-between items-start mb-4">
          <div className={`p-2 rounded-lg ${iconColorClass}`}>
            <span className="material-symbols-outlined">{icon}</span>
          </div>
          {trend && (
            <div className={`flex items-center font-label-sm text-label-sm ${trendColorClass}`}>
              <span className="material-symbols-outlined text-[16px] mr-1">{trendIcon}</span>
              {trend}
            </div>
          )}
        </div>
        <p className="font-label-sm text-label-sm text-outline uppercase tracking-wider mb-1">{title}</p>
        <div className="flex items-baseline gap-1">
          {prefix && <p className="font-label-md text-label-md text-outline">{prefix}</p>}
          <p className="font-display text-display text-on-surface">{value}</p>
        </div>
      </CardContent>
    </Card>
  );
}
