package utils

import "math/rand/v2"

// GenerateAgentName returns a whimsical 2-word handle (adjective+noun, no
// separator) assigned to a fresh agent_api_key row at creation time. Display
// handle only — not an identifier, not user-editable in V1, collisions tolerated.
func GenerateAgentName() string {
	adj := agentNameAdjectives[rand.IntN(len(agentNameAdjectives))]
	noun := agentNameNouns[rand.IntN(len(agentNameNouns))]
	return adj + noun
}

var agentNameAdjectives = []string{
	"raw", "zen", "neo", "hot", "dry", "dim", "pure", "bold",
	"cool", "dark", "fast", "free", "grim", "holy", "keen",
	"lazy", "loud", "mega", "mild", "mute", "pale", "rare",
	"real", "soft", "true", "vagu", "warm", "wild", "wise",
	"agile", "blind", "brisk", "crisp", "crypt", "heavy",
	"quick", "rapid", "sharp", "swift", "vivid",
}

var agentNameNouns = []string{
	"apex", "atom", "axis", "beta", "bolt", "byte", "clay",
	"core", "dawn", "disk", "dock", "dune", "echo", "edge",
	"envy", "flux", "fuse", "gate", "grid", "halo", "haze",
	"host", "icon", "ion", "iron", "link", "loop", "maze",
	"node", "nova", "peak", "plot", "pool", "rift", "root",
	"rust", "site", "sync", "void", "wave",
}
