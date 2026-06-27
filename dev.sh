#!/usr/bin/env zsh

# Levanta BE (puerto 3000) y FE (puerto 4200).
# - Dentro de tmux: abre dos ventanas en la sesión actual.
# - Fuera de tmux:  abre dos pestañas en gnome-terminal.
# Uso: ./dev.sh

ROOT="$(cd "$(dirname "$0")" && pwd)"
NODE_BIN="$HOME/.nvm/versions/node/v24.14.1/bin"

BE_CMD="cd \"$ROOT/satellites-be\" && PATH=\"$NODE_BIN:\$PATH\" node \"$NODE_BIN/npx\" tsx watch src/server.ts"
FE_CMD="cd \"$ROOT/satellites-fe\"  && PATH=\"$NODE_BIN:\$PATH\" node \"$NODE_BIN/npx\" ng serve --open"

if [[ -n "$TMUX" ]]; then
  tmux new-window -n "BE :3000" "zsh -c '$BE_CMD; exec zsh'"
  tmux new-window -n "FE :4200" "zsh -c '$FE_CMD; exec zsh'"
else
  gnome-terminal \
    --tab --title="BE :3000" --command="zsh -c '$BE_CMD; exec zsh'" \
    --tab --title="FE :4200" --command="zsh -c '$FE_CMD; exec zsh'"
fi
