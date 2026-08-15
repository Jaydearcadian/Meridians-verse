'use client';

import { motion } from 'framer-motion';
import { Award } from 'lucide-react';
import { containerVariants, itemVariantsLeft } from '@/lib/animations/variants';

interface LeaderboardEntry {
  rank: number;
  name: string;
  xp: number;
  yield: string;
}

const leaderboard: LeaderboardEntry[] = [
  { rank: 1, name: 'Alex Chen', xp: 15420, yield: '$1,250' },
  { rank: 2, name: 'Sarah Williams', xp: 14890, yield: '$1,180' },
  { rank: 3, name: 'Marcus Johnson', xp: 13650, yield: '$1,095' },
  { rank: 4, name: 'Emma Davis', xp: 12340, yield: '$987' },
  { rank: 5, name: 'James Wilson', xp: 11890, yield: '$945' },
];

export function LeaderboardCard() {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      whileInView={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.6 }}
      viewport={{ once: true }}
      className="bg-card border border-border rounded-2xl p-8"
    >
      <h3 className="font-semibold text-foreground mb-6 flex items-center gap-2">
        <Award size={20} className="text-primary" />
        Weekly Leaderboard
      </h3>

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
                <p className="font-semibold text-foreground">{entry.name}</p>
                <p className="text-sm text-muted-foreground">{entry.xp} XP</p>
              </div>
            </div>
            <div className="text-right">
              <p className="font-semibold text-primary">{entry.yield}</p>
              <p className="text-xs text-muted-foreground">This week</p>
            </div>
          </motion.div>
        ))}
      </motion.div>

      <button className="w-full mt-6 px-4 py-3 rounded-lg border border-primary text-primary font-semibold hover:bg-primary/5 transition-colors">
        View Full Leaderboard
      </button>
    </motion.div>
  );
}
