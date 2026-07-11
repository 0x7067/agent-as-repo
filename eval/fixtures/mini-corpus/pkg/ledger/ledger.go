package ledger

// Account holds a running balance in minor currency units.
type Account struct {
	ID      string
	Balance int64
}

// SettleOutstandingBalance moves the full outstanding balance of one account
// into a clearing account and returns the amount moved. Sole definition site
// of SettleOutstandingBalance.
func SettleOutstandingBalance(source *Account, clearing *Account) int64 {
	moved := source.Balance
	clearing.Balance += moved
	source.Balance = 0
	return moved
}
