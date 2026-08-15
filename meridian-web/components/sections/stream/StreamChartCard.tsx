'use client';

import { motion } from 'framer-motion';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { TrendingUp } from 'lucide-react';

const streamData = [
  { time: '9:00', amount: 0 },
  { time: '12:00', amount: 125 },
  { time: '15:00', amount: 250 },
  { time: '18:00', amount: 375 },
  { time: '21:00', amount: 500 },
  { time: '24:00', amount: 625 },
];

export function StreamChartCard() {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      whileInView={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.6 }}
      viewport={{ once: true }}
      className="bg-card border border-border rounded-2xl p-8"
    >
      <h3 className="font-semibold text-foreground mb-6 flex items-center gap-2">
        <TrendingUp size={20} className="text-primary" />
        Real-Time Payment Stream
      </h3>

      <ResponsiveContainer width="100%" height={300}>
        <LineChart data={streamData}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" opacity={0.5} />
          <XAxis 
            dataKey="time" 
            stroke="var(--color-muted-foreground)"
            tick={{ fill: 'var(--color-muted-foreground)' }}
            tickLine={{ stroke: 'var(--color-border)' }}
          />
          <YAxis 
            stroke="var(--color-muted-foreground)"
            tick={{ fill: 'var(--color-muted-foreground)' }}
            tickLine={{ stroke: 'var(--color-border)' }}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: 'var(--color-card)',
              borderColor: 'var(--color-border)',
              borderRadius: '8px',
              color: 'var(--color-foreground)',
            }}
            itemStyle={{ color: 'var(--color-foreground)' }}
            labelStyle={{ color: 'var(--color-muted-foreground)' }}
          />
          <Line
            type="monotone"
            dataKey="amount"
            stroke="var(--color-primary)"
            strokeWidth={3}
            dot={{ fill: 'var(--color-primary)', r: 6 }}
            activeDot={{ r: 8 }}
          />
        </LineChart>
      </ResponsiveContainer>

      <p className="text-sm text-muted-foreground mt-4">
        Your salary flows in real-time throughout the day
      </p>
    </motion.div>
  );
}
