'use client';

import { motion } from 'framer-motion';
import { Award, RefreshCw, AlertTriangle } from 'lucide-react';
import { containerVariants, itemVariantsLeft } from '@/lib/animations/variants';
import { useLeaderboard } from '@/hooks/useLeaderboard';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';

export function LeaderboardCard() {
  const { leaderboard, isLoading, error, refetch } = useLeaderboard();

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      whileInView={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.6 }}
      viewport={{ once: true }}
      className="bg-card border border-border rounded-2xl p-8"
    >
      <div className="flex items-center justify-between mb-6">
        <h3 className="font-semibold text-foreground flex items-center gap-2">
          <Award size={20} className="text-primary" />
          Weekly Leaderboard
        </h3>
        {error && (
          <Button variant="ghost" size="sm" onClick={refetch} className="gap-1 text-xs">
            <RefreshCw size={12} />
            Retry
          </Button>
        )}
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center justify-between p-4 rounded-lg border border-border">
              <div className="flex items-center gap-4">
                <Skeleton className="h-6 w-6 rounded" />
                <div className="space-y-2">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-3 w-16" />
                </div>
              </div>
              <Skeleton className="h-4 w-16" />
            </div>
          ))}
        </div>
      ) : error ? (
        <div className="p-4 rounded-lg border border-destructive/20 bg-destructive/10 text-sm flex items-center gap-2 text-foreground">
          <AlertTriangle className="text-destructive h-4 w-4 shrink-0" />
          <span>{error.message || 'Failed to load leaderboard entries'}</span>
        </div>
      ) : (
        <motion.div
          variants={containerVariants}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true }}
          className="space-y-3"
        >
          {leaderboard.map((entry) => (
            <motion.div
              key={entry.rank}
              variants={itemVariantsLeft}
              className={`flex items-center justify-between p-4 rounded-lg transition-colors ${
                entry.rank === 1
                  ? 'bg-primary/10 border border-primary/20 dark:bg-primary/20 dark:border-primary/30'
                  : 'border border-border hover:border-primary/20 dark:hover:border-primary/30'
              }`}
            >
              <div className="flex items-center gap-4">
                <div className="font-bold text-primary text-lg w-6"># {entry.rank}</div>
                <div>
                  <p className="font-semibold text-foreground flex items-center gap-1.5">
                    {entry.name}
                    {entry.verified && (
                      <span className="text-[10px] bg-primary/20 text-primary px-1.5 py-0.5 rounded font-mono">
                        VERIFIED
                      </span>
                    )}
                  </p>
                  <p className="text-sm text-muted-foreground">{entry.xp.toLocaleString()} XP</p>
                </div>
              </div>
              <div className="text-right">
                <p className="font-semibold text-primary">{entry.yield}</p>
                <p className="text-xs text-muted-foreground">This week</p>
              </div>
            </motion.div>
          ))}
        </motion.div>
      )}

      <button className="w-full mt-6 px-4 py-3 rounded-lg border border-primary text-primary font-semibold hover:bg-primary/5 transition-colors">
        View Full Leaderboard
      </button>
    </motion.div>
  );
}
