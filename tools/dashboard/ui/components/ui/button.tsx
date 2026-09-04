import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { forwardRef, type ButtonHTMLAttributes } from 'react';

import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center rounded-lg text-sm font-semibold whitespace-nowrap transition-colors outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        default: 'bg-accent-solid text-fg-on-accent hover:bg-accent-solid/90',
        secondary:
          'border border-border bg-surface-raised text-fg-primary hover:border-border-strong hover:bg-surface-hover',
        ghost: 'text-fg-muted hover:bg-surface-hover hover:text-fg-primary',
        destructive:
          'border border-action-destructive/40 bg-transparent text-action-destructive hover:border-action-destructive/60 hover:bg-action-destructive/5 focus-visible:ring-action-destructive',
      },
      size: {
        default: 'h-10 px-4 py-2',
        sm: 'h-8 rounded-md px-3 text-xs',
        icon: 'size-10',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant, size, asChild = false, ...props },
  ref,
) {
  const Component = asChild ? Slot : 'button';
  return <Component ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props} />;
});
