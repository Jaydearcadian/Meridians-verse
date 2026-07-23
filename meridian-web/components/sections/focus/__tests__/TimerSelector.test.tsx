import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { TimerSelector } from '../TimerSelector';

// Mock framer-motion to avoid animation-related rendering issues in jsdom
vi.mock('framer-motion', async () => {
  const actual = await vi.importActual('framer-motion');
  return {
    ...actual,
    motion: {
      div: ({ children, ...props }: React.ComponentProps<'div'>) => (
        <div {...props}>{children}</div>
      ),
    },
    AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  };
});

// Mock the useFocusSession hook with default idle state
const mockStartSession = vi.fn();
const mockCancelSession = vi.fn();
const mockTriggerCompleteSession = vi.fn();

vi.mock('@/hooks/useFocusSession', () => ({
  useFocusSession: vi.fn(() => ({
    activeSession: null,
    timeLeft: 0,
    isActive: false,
    isLoading: false,
    startSession: mockStartSession,
    cancelSession: mockCancelSession,
    triggerCompleteSession: mockTriggerCompleteSession,
  })),
}));

describe('TimerSelector — idle state', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the heading and all three duration options', () => {
    render(<TimerSelector />);

    expect(
      screen.getByText('Choose Your Focus Duration')
    ).toBeVisible();

    for (const minutes of [10, 25, 45]) {
      expect(screen.getByText(`${minutes} min`)).toBeVisible();
    }
  });

  it('highlights the 25-minute option by default', () => {
    render(<TimerSelector />);

    const defaultBtn = screen.getByText('25 min');
    // The selected button gets a primary background class
    expect(defaultBtn.className).toContain('bg-primary');
  });

  it('switches the selected duration when a different option is clicked', () => {
    render(<TimerSelector />);

    fireEvent.click(screen.getByText('45 min'));

    const btn45 = screen.getByText('45 min');
    const btn25 = screen.getByText('25 min');

    expect(btn45.className).toContain('bg-primary');
    expect(btn25.className).not.toContain('bg-primary');
  });

  it('calls startSession with the selected duration on button press', () => {
    render(<TimerSelector />);

    fireEvent.click(screen.getByText('Start Focus Session'));

    expect(mockStartSession).toHaveBeenCalledWith(25);
  });
});

describe('TimerSelector — active session state', () => {
  beforeEach(async () => {
    vi.clearAllMocks();

    // Re-mock useFocusSession to return an active state
    const useFocusSession = (await vi.importActual('@/hooks/useFocusSession')) as any;
    vi.mocked(useFocusSession).mockReturnValue({
      activeSession: { durationMinutes: 25 },
      timeLeft: 25 * 60,
      isActive: true,
      isLoading: false,
      startSession: mockStartSession,
      cancelSession: mockCancelSession,
      triggerCompleteSession: mockTriggerCompleteSession,
    });
  });

  it('renders the timer display when a session is active', () => {
    render(<TimerSelector />);

    expect(screen.getByText('Session in Progress')).toBeVisible();
    // The timer should show minutes:seconds format
    expect(screen.getByText('25:00')).toBeVisible();
  });

  it('calls cancelSession when Cancel is pressed', () => {
    render(<TimerSelector />);

    fireEvent.click(screen.getByText('Cancel'));
    expect(mockCancelSession).toHaveBeenCalledTimes(1);
  });

  it('calls triggerCompleteSession when Simulate End is pressed', () => {
    render(<TimerSelector />);

    fireEvent.click(screen.getByText('Simulate End'));
    expect(mockTriggerCompleteSession).toHaveBeenCalledTimes(1);
  });
});

describe('TimerSelector — loading state', () => {
  beforeEach(async () => {
    vi.clearAllMocks();

    const useFocusSession = (await vi.importActual('@/hooks/useFocusSession')) as any;
    vi.mocked(useFocusSession).mockReturnValue({
      activeSession: { durationMinutes: 25 },
      timeLeft: 25 * 60,
      isActive: true,
      isLoading: true,
      startSession: mockStartSession,
      cancelSession: mockCancelSession,
      triggerCompleteSession: mockTriggerCompleteSession,
    });
  });

  it('shows a spinner and disables the action button while loading', () => {
    render(<TimerSelector />);

    // The loading spinner is inside the "Simulate End" button
    const endButton = screen.getByText('Syncing...');
    expect(endButton).toBeVisible();
    expect(endButton.closest('button')).toBeDisabled();
  });
});
