# frozen_string_literal: true

module Billing
  # Applies charges and fees to an outstanding invoice.
  class Charge
    LATE_FEE_RATE = 0.015

    def initialize(invoice)
      @invoice = invoice
    end

    # Add a flat percentage late fee onto an overdue invoice and return the new
    # total. Sole definition site of apply_late_fee.
    def apply_late_fee
      fee = (@invoice[:amount_cents] * LATE_FEE_RATE).round
      @invoice[:amount_cents] += fee
      @invoice[:amount_cents]
    end
  end
end
