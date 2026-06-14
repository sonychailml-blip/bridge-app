import { useState } from "react";
import { doc, collection, onSnapshot } from "firebase/firestore";
import { db } from "../firebase";
import { getFunctions, httpsCallable } from "firebase/functions";

export default function Admin({ statements, allUsers, onDelete, onNotif }) {
  const [searchQuery, setSearchQuery] = useState("");
  const [userCount, setUserCount] = useState(allUsers.length);

  const deleteStatement = async (id) => {
    const { deleteDoc } = await import("firebase/firestore");
    await deleteDoc(doc(db, "statements", id));
    onNotif("Statement deleted");
  };

  const blockUser = async (uid) => {
    const fns = getFunctions(undefined, "europe-west1");
    const setUserBlocked = httpsCallable(fns, "setUserBlocked");
    await setUserBlocked({ targetUid: uid, blocked: true });
    onNotif("User blocked");
  };

  const unblockUser = async (uid) => {
    const fns = getFunctions(undefined, "europe-west1");
    const setUserBlocked = httpsCallable(fns, "setUserBlocked");
    await setUserBlocked({ targetUid: uid, blocked: false });
    onNotif("User unblocked");
  };

  const reportedStatements = statements.filter(s => s.reports > 0).sort((a, b) => b.reports - a.reports);
  const filteredStatements = statements.filter(s =>
    searchQuery === "" || s.text.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="list-section">
      <div className="section-header">
        <div className="section-sub">administration</div>
      </div>

      {/* STATS */}
      <div style={{display:"flex",gap:24,padding:"20px 0",borderBottom:"1px solid #f0f0f0"}}>
        <div style={{textAlign:"center"}}>
          <div style={{fontSize:28,fontFamily:"Playfair Display,serif",fontWeight:400}}>{allUsers.length}</div>
          <div style={{fontSize:10,letterSpacing:2,textTransform:"uppercase",color:"#bbb",marginTop:4}}>users</div>
        </div>
        <div style={{textAlign:"center"}}>
          <div style={{fontSize:28,fontFamily:"Playfair Display,serif",fontWeight:400}}>{statements.length}</div>
          <div style={{fontSize:10,letterSpacing:2,textTransform:"uppercase",color:"#bbb",marginTop:4}}>statements</div>
        </div>
        <div style={{textAlign:"center"}}>
          <div style={{fontSize:28,fontFamily:"Playfair Display,serif",fontWeight:400}}>{allUsers.filter(u => u.clicked?.length > 0).length}</div>
          <div style={{fontSize:10,letterSpacing:2,textTransform:"uppercase",color:"#bbb",marginTop:4}}>active</div>
        </div>
      </div>

      {/* REPORTED STATEMENTS */}
      {reportedStatements.length > 0 && (
        <>
          <div style={{padding:"16px 0 8px",fontSize:10,letterSpacing:2,textTransform:"uppercase",color:"#999"}}>
            Reported statements
          </div>
          {reportedStatements.map(s => (
            <div key={s.id} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"12px 0",borderBottom:"1px solid #f5f5f5",gap:12}}>
              <div style={{flex:1}}>
                <div style={{fontSize:14,color:"#111"}}>{s.text}</div>
                <div style={{fontSize:10,color:"#ccc",marginTop:3,textTransform:"uppercase",letterSpacing:1}}>
                  {s.author} · {s.reports} report{s.reports > 1 ? "s" : ""}
                </div>
              </div>
              <button onClick={() => deleteStatement(s.id)} style={{background:"none",border:"1px solid #111",padding:"5px 12px",fontFamily:"Lato,sans-serif",fontWeight:300,fontSize:10,letterSpacing:2,textTransform:"uppercase",cursor:"pointer",color:"#111",whiteSpace:"nowrap"}}>
                Delete
              </button>
            </div>
          ))}
        </>
      )}

      {/* ALL STATEMENTS */}
      <div style={{padding:"16px 0 8px",fontSize:10,letterSpacing:2,textTransform:"uppercase",color:"#999",marginTop:8}}>
        All statements
      </div>
      <div style={{marginBottom:12}}>
        <input
          style={{width:"100%",border:"none",borderBottom:"1px solid #f0f0f0",padding:"8px 0",fontFamily:"Lato,sans-serif",fontWeight:300,fontSize:13,outline:"none",background:"transparent",color:"#111"}}
          placeholder="search…"
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
        />
      </div>
      {filteredStatements.map(s => (
        <div key={s.id} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"12px 0",borderBottom:"1px solid #f5f5f5",gap:12}}>
          <div style={{flex:1}}>
            <div style={{fontSize:14,color:"#111"}}>{s.text}</div>
            <div style={{fontSize:10,color:"#ccc",marginTop:3,textTransform:"uppercase",letterSpacing:1}}>
              {s.author} · {(s.clicks||0).toLocaleString()} clicks
              {s.reports > 0 && <span style={{color:"#e0a0a0"}}> · {s.reports} reports</span>}
            </div>
          </div>
          <button onClick={() => deleteStatement(s.id)} style={{background:"none",border:"1px solid #ddd",padding:"5px 12px",fontFamily:"Lato,sans-serif",fontWeight:300,fontSize:10,letterSpacing:2,textTransform:"uppercase",cursor:"pointer",color:"#999",whiteSpace:"nowrap",transition:"all .15s"}}>
            Delete
          </button>
        </div>
      ))}

      {/* ALL USERS */}
      <div style={{padding:"16px 0 8px",fontSize:10,letterSpacing:2,textTransform:"uppercase",color:"#999",marginTop:8}}>
        All users
      </div>
      {allUsers.map(u => (
        <div key={u.id} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"12px 0",borderBottom:"1px solid #f5f5f5",gap:12}}>
          <div style={{flex:1}}>
            <div style={{fontSize:14,color:u.blocked?"#ccc":"#111"}}>{u.nickname} {u.blocked && "· blocked"}</div>
            <div style={{fontSize:10,color:"#ccc",marginTop:3,textTransform:"uppercase",letterSpacing:1}}>
              {(u.clicked||[]).length} statements clicked
            </div>
          </div>
          <button onClick={() => u.blocked ? unblockUser(u.id) : blockUser(u.id)} style={{background:"none",border:"1px solid #ddd",padding:"5px 12px",fontFamily:"Lato,sans-serif",fontWeight:300,fontSize:10,letterSpacing:2,textTransform:"uppercase",cursor:"pointer",color:u.blocked?"#111":"#999",whiteSpace:"nowrap"}}>
            {u.blocked ? "Unblock" : "Block"}
          </button>
        </div>
      ))}
    </div>
  );
}
