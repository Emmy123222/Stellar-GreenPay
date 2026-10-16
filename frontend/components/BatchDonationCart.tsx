/**
 * components/BatchDonationCart.tsx
 * Donation cart for multi-project batch donations
 */
import { useState } from "react";
import { formatXLM, formatCO2 } from "@/utils/format";
import type { ClimateProject } from "@/utils/types";

interface CartItem {
  project: ClimateProject;
  amount: string;
}

interface BatchDonationCartProps {
  publicKey: string;
  onDonate?: (items: CartItem[]) => void;
}

export default function BatchDonationCart({ publicKey, onDonate }: BatchDonationCartProps) {
  const [cart, setCart] = useState<CartItem[]>([]);
  const [isOpen, setIsOpen] = useState(false);

  const addToCart = (project: ClimateProject, amount: string) => {
    if (!amount || parseFloat(amount) <= 0) return;
    
    const existingIndex = cart.findIndex(item => item.project.id === project.id);
    if (existingIndex >= 0) {
      const updated = [...cart];
      updated[existingIndex] = { project, amount };
      setCart(updated);
    } else {
      if (cart.length >= 10) {
        alert("Maximum 10 projects per batch donation");
        return;
      }
      setCart([...cart, { project, amount }]);
    }
  };

  const removeFromCart = (projectId: string) => {
    setCart(cart.filter(item => item.project.id !== projectId));
  };

  const updateAmount = (projectId: string, amount: string) => {
    setCart(cart.map(item => 
      item.project.id === projectId ? { ...item, amount } : item
    ));
  };

  const totalXLM = cart.reduce((sum, item) => sum + (parseFloat(item.amount) || 0), 0);
  const totalCO2 = cart.reduce((sum, item) => {
    const amount = parseFloat(item.amount) || 0;
    return sum + (amount * (item.project.co2_per_xlm || 0)) / 1000;
  }, 0);

  const handleDonateAll = () => {
    if (cart.length === 0) return;
    onDonate?.(cart);
    setCart([]);
    setIsOpen(false);
  };

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="btn-primary flex items-center gap-2"
        aria-label="Open donation cart"
      >
        🛒 Batch Donate
        {cart.length > 0 && (
          <span className="bg-white text-forest-600 rounded-full px-2 py-0.5 text-xs font-bold">
            {cart.length}
          </span>
        )}
      </button>
    );
  }

  return (
    <div className="card animate-slide-up">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-display text-lg font-semibold text-forest-900">
          Donation Cart ({cart.length}/10)
        </h3>
        <button
          onClick={() => setIsOpen(false)}
          className="text-sm text-forest-600 hover:text-forest-700"
          aria-label="Close cart"
        >
          ✕
        </button>
      </div>

      {cart.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground">
          <p className="text-4xl mb-2">🛒</p>
          <p>Your cart is empty</p>
          <p className="text-sm mt-1">Add projects to donate to multiple at once</p>
        </div>
      ) : (
        <>
          <div className="space-y-3 mb-4 max-h-64 overflow-y-auto">
            {cart.map((item) => (
              <div
                key={item.project.id}
                className="flex items-center gap-3 p-3 bg-forest-50 rounded-lg"
              >
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-forest-900 truncate">{item.project.name}</p>
                  <p className="text-xs text-forest-600">
                    CO₂: {formatCO2((parseFloat(item.amount) || 0) * (item.project.co2_per_xlm || 0) / 1000)}
                  </p>
                </div>
                <input
                  type="number"
                  value={item.amount}
                  onChange={(e) => updateAmount(item.project.id, e.target.value)}
                  min="1"
                  step="1"
                  className="w-20 input-field text-sm"
                  aria-label={`Donation amount for ${item.project.name}`}
                />
                <button
                  onClick={() => removeFromCart(item.project.id)}
                  className="text-red-500 hover:text-red-600 p-1"
                  aria-label={`Remove ${item.project.name} from cart`}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>

          <div className="border-t border-forest-200 pt-4 space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-forest-600">Total XLM:</span>
              <span className="font-bold text-forest-900">{formatXLM(totalXLM)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-forest-600">Total CO₂ Offset:</span>
              <span className="font-bold text-forest-900">{formatCO2(totalCO2)}</span>
            </div>
          </div>

          <button
            onClick={handleDonateAll}
            disabled={!publicKey || cart.length === 0}
            className="btn-primary w-full mt-4"
          >
            Donate All ({formatXLM(totalXLM)})
          </button>
        </>
      )}
    </div>
  );
}
