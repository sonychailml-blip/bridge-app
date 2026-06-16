export default function Philosophy({ onClose }) {
  return (
    <>
      <div style={{position:"fixed",inset:0,zIndex:24}} onClick={onClose}/>
      <div className="profile-panel" onClick={e => e.stopPropagation()}>
        <div style={{textAlign:"center",padding:"28px 0 4px"}}>
          <div style={{fontFamily:"'Playfair Display',serif",fontSize:72,fontWeight:400,letterSpacing:6,lineHeight:1}}>H</div>
        </div>
        <div style={{fontFamily:"'Lato',sans-serif",fontWeight:300,fontSize:15,lineHeight:1.75,color:"#444",fontStyle:"italic",padding:"20px 8px 0",maxWidth:420,margin:"0 auto"}}>
          “H is a space where people find each other through meaning, not photographs. Every statement you agree with is a part of you. When your agreements overlap with someone’s — it’s not chance. Maybe you see the world alike.”
        </div>
      </div>
    </>
  );
}
