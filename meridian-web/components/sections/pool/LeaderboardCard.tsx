'use client';

import { motion } from 'framer-motion';
import { Award } from 'lucide-react';
import { cardReveal, containerVariants, itemVariantsLeft, sectionViewport } from '@/lib/animations/variants';
import { verifyProof } from '@/lib/merkle-proof';

interface LeaderboardEntry {
  rank: number;
  name: string;
  xp: number;
  yield: string;
  proof?: { leaf: string; proof: string[]; root: string; verified: boolean; leafIndex: number } | null;
}

const leaderboard: LeaderboardEntry[] = [
  { rank: 1, name: 'Alex Chen', xp: 15420, yield: '$1,250', proof: { leaf: 'a1b2c3', proof: ['d4e5f6'], root: 'root-hash', verified: true, leafIndex: 0 } },
  { rank: 2, name: 'Sarah Williams', xp: 14890, yield: '$1,180', proof: { leaf: 'b2c3d4', proof: ['e5f6a1'], root: 'root-hash', verified: true, leafIndex: 1 } },
  { rank: 3, name: 'Marcus Johnson', xp: 13650, yield: '$1,095', proof: null },
  { rank: 4, name: 'Emma Davis', xp: 12340, yield: '$987', proof: null },
  { rank: 5, name: 'James Wilson', xp: 11890, yield: '$945', proof: null },
];

export function LeaderboardCard() {
  return (
    <motion.div
      role="presentation"
      aria-hidden="true"
      variants={cardReveal}
      initial="hidden"
      whileInView="visible"
      viewport={sectionViewport}
      className="bg-card border border-border rounded-2xl p-8"
    >
      <div className="sr-only">Weekly Leaderboard</div>
      <h3 className="font-semibold text-foreground mb-6 flex items-center gap-2">
        <Award size={20} className="text-primary" />
        Weekly Leaderboard
      </h3>

      <motion.div
        variants={containerVariants}
        initial="hidden"
        whileInView="visible"
        viewport={sectionViewport}
        className="space-y-3"
      >
        {leaderboard.map((entry) => {
          const isVerified = entry.proof
            ? verifyProof(entry.proof.leaf, entry.proof.proof, entry.proof.root)
            : false;
          return (
          <motion.div
            key={entry.rank}
            variants={itemVariantsLeft}
            className={`flex items-center justify-between p-4 rounded-lg transition-colors ${
              entry.rank === 1
                ? 'bg-primary/10 border border-primary/20'
                : 'border border-border hover:border-primary/20'
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
              <p className="text-xs text-muted-foreground">{isVerified ? 'Verified proof' : 'Missing proof'}</p>
            </div>
          </motion.div>
          );
        })}
      </motion.div>

      <button className="w-full mt-6 px-4 py-3 rounded-lg border border-primary text-primary font-semibold hover:bg-primary/5 transition-colors">
        View Full Leaderboard
      </button>
    </motion.div>
  );
}
