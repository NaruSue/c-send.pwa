// One new attack type per minute; progression stops at five minutes.
globalThis.NekoDifficulty = (() => {
  const profiles = {
    mugi: {small:.12, double:.25, rapid:.55, pair:.25, gap:1050, window:1100},
    kuro: {small:.65, double:.12, rapid:0, pair:0, gap:1450, window:950},
    koma: {small:.28, double:.30, rapid:.28, pair:.18, gap:1200, window:1150},
    boss:{small:.15,double:.4,rapid:.5,pair:.6,gap:1050,window:1100},
    twins:{small:.12,double:.25,rapid:.3,pair:1,gap:2200,window:1600},
    yuki: {small:0, double:.40, rapid:.45, pair:.55, gap:1550, window:1400}
  };
  function plan(id, elapsed, random=Math.random) {
    const p=profiles[id],stage=Math.min(5,Math.floor(Math.max(0,elapsed)/60000));
    const weight={small:stage>=1?p.small:0,double:stage>=2?p.double:0,rapid:stage>=3?p.rapid:0};
    // Keep normal punches throughout, including at the highest stage.
    const roll=random();let type='normal',total=0;
    for(const kind of ['small','double','rapid']){total+=weight[kind]*.8;if(roll<total){type=kind;break}}
    const taps=type==='double'?2:type==='rapid'?(stage>=4&&random()<.4?4:3):1;
    const base=p.window*(1-Math.min(stage,4)*.04);
    return {stage,type,taps,size:type==='small'?64:id==='yuki'?90:82,
      window:Math.round(base*(taps===1?1:taps===2?1.65:2.5)),
      gap:p.gap*(1-Math.max(0,stage-3)*.08),pair:p.pair};
  }
  return {plan};
})();
