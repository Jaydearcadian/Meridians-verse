'use client';

import { motion } from 'framer-motion';
import { Clock } from 'lucide-react';
import { itemVariants } from '@/lib/animations/variants';

const timerOptions = [10, 25, 45] as const;

export function TimerSelector() {
  return (
    <motion.div variants={itemVariants} className="bg-card border border-border rounded-2xl p-8">
      <h3 className="font-semibold text-foreground mb-4 flex items-center gap-2">
        <Clock size={20} className="text-primary" />
        Choose Your Focus Duration
      </h3>
      <div className="grid grid-cols-3 gap-3">
        {timerOptions.map((minutes) => (
          <button
            key={minutes}
            className="py-3 rounded-lg border border-primary bg-primary/10 hover:bg-primary/20 dark:bg-primary/20 dark:hover:bg-primary/30 text-primary font-semibold transition-colors"
          >
            {minutes} min
          </button>
        ))}
      </div>
    </motion.div>
  );
}
