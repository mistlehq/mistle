prepend_path_once() {
  case ":$PATH:" in
    *":$1:"*) ;;
    *)
      PATH="$1:$PATH"
      ;;
  esac
}

prepend_path_once /workspace/.mistle/bin
prepend_path_once /home/sandbox/.local/share/mise/shims

export PATH
