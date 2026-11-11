import { cn } from "@/lib/utils";

interface SkeletonProps {
  className?: string;
}

export function Skeleton({ className }: SkeletonProps) {
  return (
    <div
      aria-hidden="true"
      className={cn("rounded-lg skeleton-shimmer", className)}
    />
  );
}

export function TorrentsSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div aria-busy="true" aria-label="Loading torrents">
      {/* Mobile Card Skeletons */}
      <div className="md:hidden space-y-3">
        <div className="flex items-center justify-between px-1">
          <Skeleton className="h-10 w-32 rounded-xl" />
          <Skeleton className="h-4 w-36" />
        </div>
        {Array.from({ length: count }).map((_, idx) => (
          <div key={idx} className="glass rounded-2xl p-4 space-y-3">
            <div className="flex items-start gap-3">
              <Skeleton className="w-6 h-6 rounded-lg flex-shrink-0 mt-0.5" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-4/5" />
                <Skeleton className="h-4 w-2/5" />
                <div className="flex items-center gap-2 pt-1">
                  <Skeleton className="h-5 w-24 rounded-md" />
                  <Skeleton className="h-4 w-12" />
                </div>
              </div>
              <Skeleton className="w-6 h-8 rounded-lg flex-shrink-0" />
            </div>

            <Skeleton className="h-2 w-full rounded-full" />

            <div className="grid grid-cols-3 gap-3 p-3 rounded-xl bg-surface-elevated/80 border border-glass-border">
              <div className="space-y-1.5">
                <Skeleton className="h-3 w-10" />
                <Skeleton className="h-4 w-16" />
              </div>
              <div className="space-y-1.5">
                <Skeleton className="h-3 w-10" />
                <Skeleton className="h-4 w-12" />
              </div>
              <div className="space-y-1.5">
                <Skeleton className="h-3 w-10" />
                <Skeleton className="h-4 w-10" />
              </div>
            </div>

            <div className="flex items-center justify-between pt-0.5">
              <div className="flex items-center gap-4">
                <Skeleton className="h-4 w-16" />
                <Skeleton className="h-4 w-16" />
              </div>
              <Skeleton className="w-11 h-11 rounded-xl" />
            </div>
          </div>
        ))}
      </div>

      {/* Desktop Table Skeleton */}
      <div className="hidden md:block glass rounded-xl overflow-hidden">
        <div className="border-b border-glass-border px-4 py-3 flex items-center gap-4">
          <Skeleton className="w-4 h-4 rounded" />
          <Skeleton className="h-3.5 w-32" />
          <Skeleton className="h-3.5 w-20 ml-auto" />
          <Skeleton className="h-3.5 w-36" />
          <Skeleton className="h-3.5 w-16" />
          <Skeleton className="h-3.5 w-20" />
          <Skeleton className="h-3.5 w-20" />
          <Skeleton className="h-3.5 w-12" />
          <Skeleton className="h-3.5 w-20" />
        </div>
        <div className="divide-y divide-glass-border/50">
          {Array.from({ length: count + 2 }).map((_, idx) => (
            <div key={idx} className="px-4 py-3.5 flex items-center gap-4">
              <Skeleton className="w-4 h-4 rounded flex-shrink-0" />
              <div className="w-64 space-y-1.5 flex-shrink-0">
                <Skeleton className="h-4 w-52" />
                <Skeleton className="h-3 w-28" />
              </div>
              <Skeleton className="h-5 w-24 rounded-md ml-auto" />
              <Skeleton className="h-2.5 w-40 rounded-full" />
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-4 w-10" />
              <div className="flex items-center gap-1.5">
                <Skeleton className="w-7 h-7 rounded-lg" />
                <Skeleton className="w-7 h-7 rounded-lg" />
                <Skeleton className="w-7 h-7 rounded-lg" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function DashboardSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading dashboard" className="space-y-6">
      <div className="space-y-2">
        <Skeleton className="h-7 w-36" />
        <Skeleton className="h-4 w-64" />
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, idx) => (
          <div key={idx} className="glass rounded-xl p-5 space-y-3">
            <div className="flex items-start justify-between">
              <div className="space-y-2 flex-1">
                <Skeleton className="h-3 w-24" />
                <Skeleton className="h-7 w-28" />
                <Skeleton className="h-3 w-32" />
              </div>
              <Skeleton className="w-10 h-10 rounded-xl" />
            </div>
          </div>
        ))}
      </div>
      <div className="glass rounded-xl p-5 space-y-4">
        <div className="flex justify-between items-center">
          <Skeleton className="h-5 w-36" />
          <Skeleton className="h-4 w-32" />
        </div>
        <Skeleton className="h-[200px] w-full rounded-xl" />
      </div>
    </div>
  );
}

export function ListSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div aria-busy="true" aria-label="Loading content" className="space-y-3">
      {Array.from({ length: rows }).map((_, idx) => (
        <div key={idx} className="glass rounded-xl p-4 space-y-2.5">
          <div className="flex items-center justify-between gap-3">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-5 w-16 rounded-md" />
          </div>
          <Skeleton className="h-3 w-1/2" />
        </div>
      ))}
    </div>
  );
}

export function SystemCardSkeleton() {
  return (
    <div aria-busy="true" className="space-y-3.5 py-1">
      <Skeleton className="h-10 w-full rounded-xl" />
      <div className="space-y-2">
        <div className="flex justify-between">
          <Skeleton className="h-3.5 w-16" />
          <Skeleton className="h-3.5 w-24" />
        </div>
        <Skeleton className="h-2.5 w-full rounded-full" />
      </div>
      <div className="space-y-2">
        <div className="flex justify-between">
          <Skeleton className="h-3.5 w-16" />
          <Skeleton className="h-3.5 w-32" />
        </div>
        <Skeleton className="h-2.5 w-full rounded-full" />
      </div>
      <div className="space-y-2">
        <div className="flex justify-between">
          <Skeleton className="h-3.5 w-24" />
          <Skeleton className="h-3.5 w-32" />
        </div>
        <Skeleton className="h-2.5 w-full rounded-full" />
      </div>
    </div>
  );
}

export function TorrentDetailSkeleton() {
  return (
    <div aria-busy="true" className="space-y-5">
      <div className="space-y-2">
        <Skeleton className="h-5 w-4/5" />
        <div className="flex gap-2">
          <Skeleton className="h-5 w-24 rounded-md" />
          <Skeleton className="h-4 w-16" />
        </div>
      </div>
      <Skeleton className="h-14 w-full rounded-xl" />
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-20 w-full rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-12 w-full rounded-lg" />
      <Skeleton className="h-12 w-full rounded-lg" />
    </div>
  );
}
