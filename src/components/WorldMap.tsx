import type { Tables } from "@/integrations/supabase/types";

type TripStep = Tables<"trip_steps">;

export function WorldMap({ steps }: { steps: TripStep[] }) {
  return (
    <div className="relative w-full overflow-hidden rounded-2xl bg-secondary/50 shadow-card">
      <svg viewBox="-180 -90 360 180" className="h-full w-full" style={{ minHeight: 320 }}>
        <rect x="-180" y="-90" width="360" height="180" className="fill-secondary/30" />
        {[-120, -60, 0, 60, 120].map((lng) => (
          <line key={`lng-${lng}`} x1={lng} y1="-90" x2={lng} y2="90" className="stroke-border" strokeWidth="0.3" />
        ))}
        {[-60, -30, 0, 30, 60].map((lat) => (
          <line key={`lat-${lat}`} x1="-180" y1={-lat} x2="180" y2={-lat} className="stroke-border" strokeWidth="0.3" />
        ))}
        {/* Continent shapes */}
        <path d="M-160,-60 L-130,-70 L-100,-65 L-80,-50 L-70,-30 L-80,-15 L-100,-10 L-120,-20 L-140,-35 L-155,-50 Z" className="fill-muted stroke-border" strokeWidth="0.5" />
        <path d="M-80,-10 L-60,-5 L-50,0 L-45,15 L-50,30 L-55,45 L-65,55 L-75,50 L-80,35 L-78,20 L-82,5 Z" className="fill-muted stroke-border" strokeWidth="0.5" />
        <path d="M-10,-65 L0,-70 L20,-68 L35,-60 L30,-50 L20,-45 L10,-42 L0,-45 L-10,-50 L-15,-58 Z" className="fill-muted stroke-border" strokeWidth="0.5" />
        <path d="M-10,-35 L10,-35 L25,-25 L35,-10 L40,5 L35,20 L25,35 L15,35 L5,30 L-5,20 L-10,5 L-15,-10 L-15,-25 Z" className="fill-muted stroke-border" strokeWidth="0.5" />
        <path d="M35,-65 L60,-70 L90,-68 L120,-60 L140,-50 L150,-40 L145,-30 L130,-25 L110,-20 L95,-30 L80,-35 L60,-40 L45,-45 L35,-55 Z" className="fill-muted stroke-border" strokeWidth="0.5" />
        <path d="M95,-20 L110,-15 L120,-10 L115,0 L105,5 L95,-5 L90,-15 Z" className="fill-muted stroke-border" strokeWidth="0.5" />
        <path d="M110,15 L140,10 L155,18 L150,35 L135,38 L115,30 L110,20 Z" className="fill-muted stroke-border" strokeWidth="0.5" />

        {/* Step dots and paths grouped by trip */}
        {steps.length > 0 && (() => {
          const byTrip = new Map<string, TripStep[]>();
          steps.forEach((s) => {
            const arr = byTrip.get(s.trip_id) || [];
            arr.push(s);
            byTrip.set(s.trip_id, arr);
          });
          return Array.from(byTrip.entries()).map(([tripId, tripSteps]) => {
            const pathData = tripSteps.map((s, i) => `${i === 0 ? "M" : "L"}${s.longitude},${-s.latitude}`).join(" ");
            return (
              <g key={tripId}>
                <path d={pathData} fill="none" className="stroke-primary" strokeWidth="0.8" strokeDasharray="2,1" strokeLinecap="round" />
                {tripSteps.map((step) => (
                  <g key={step.id}>
                    <circle cx={step.longitude} cy={-step.latitude} r="1.5" className="fill-primary" />
                    <circle cx={step.longitude} cy={-step.latitude} r="3" className="fill-primary/20" />
                  </g>
                ))}
              </g>
            );
          });
        })()}
      </svg>
    </div>
  );
}
