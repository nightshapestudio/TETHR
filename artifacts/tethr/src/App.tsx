import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/toaster";
import TethrEditor from "@/components/TethrEditor";

function App() {
  return (
    <TooltipProvider>
      <TethrEditor />
      <Toaster />
    </TooltipProvider>
  );
}

export default App;
