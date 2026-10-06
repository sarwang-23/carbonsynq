import Header from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";
import Hero from "@/components/sections/Hero";
import Scopes from "@/components/sections/Scopes";
import Capabilities from "@/components/sections/Capabilities";
import Solutions from "@/components/sections/Solutions";

export default function Landing() {
  return (
    <div>
      <div className="relative font-sans">
        <Header />

        <main>
          <Hero />

          <div className="bg-white text-black">
            <Scopes />
            <Capabilities />
            <Solutions />
          </div>
        </main>

        <Footer />
      </div>
    </div>
  );
}
