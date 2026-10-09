import { CRM } from "@/components/atomic-crm/root/CRM";
import snowenduroLogo from "./assets/snowenduro-mark.svg";
import { SnowLoginPage } from "./modules/auth/SnowLoginPage";
import { SetupRequiredPage } from "./modules/auth/SetupRequiredPage";

const App = () => {
  if (
    !import.meta.env.VITE_SUPABASE_URL ||
    !import.meta.env.VITE_SB_PUBLISHABLE_KEY
  )
    return <SetupRequiredPage />;
  return (
    <CRM
      title="SnowEnduro CRM"
      darkModeLogo={snowenduroLogo}
      lightModeLogo={snowenduroLogo}
      loginPage={SnowLoginPage}
      disableTelemetry
    />
  );
};

export default App;
