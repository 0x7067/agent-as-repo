# frozen_string_literal: true

module Ledger
  # Clears pending ledger entries against their matching counterparties.
  class Reconciler
    def initialize(entries)
      @entries = entries
    end

    # Settle every pending entry that has a matched counterparty, returning the
    # count settled. Sole definition site of settle_pending_entries.
    def settle_pending_entries
      settled = 0
      @entries.each do |entry|
        next unless entry[:matched]

        entry[:status] = :settled
        settled += 1
      end
      settled
    end
  end
end
