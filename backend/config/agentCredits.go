
package config

import (
	"fmt"
	"os"
	"strconv"
)

// AgentCredits holds operator-credit policy loaded from the environment.
var AgentCredits AgentCreditsConfiguration

// AgentCreditsConfiguration defines the agent-credits knobs.
type AgentCreditsConfiguration struct {
	// TrialMicrounits is the signup grant credited to every new agent
	// operator. Zero disables the trial entirely. Funded by Sangria from the
	// Trial Grants Issued expense account.
	TrialMicrounits int64
}

// LoadAgentCreditsConfig reads AGENT_TRIAL_MICROUNITS. Default is 0 — no
// trial credit unless the operator opts in via env. CreateAgentOperator
// rejects negatives, so we mirror that check here at boot time.
func LoadAgentCreditsConfig() error {
	raw := os.Getenv("AGENT_TRIAL_MICROUNITS")
	if raw == "" {
		AgentCredits = AgentCreditsConfiguration{TrialMicrounits: 0}
		return nil
	}
	n, err := strconv.ParseInt(raw, 10, 64)
	if err != nil {
		return fmt.Errorf("invalid AGENT_TRIAL_MICROUNITS: %w", err)
	}
	if n < 0 {
		return fmt.Errorf("AGENT_TRIAL_MICROUNITS must be non-negative, got %d", n)
	}
	AgentCredits = AgentCreditsConfiguration{TrialMicrounits: n}
	return nil
}
