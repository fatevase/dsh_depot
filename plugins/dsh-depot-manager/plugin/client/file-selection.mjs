// Directory readers can outlive a closed dialog. Only its latest live read may publish.
export function createFileSelection(onresult){
 let generation=0,disposed=false
 return{
  async read(build){const id=++generation;try{const groups=await build();if(!disposed&&id===generation)onresult(groups)}catch(e){if(!disposed&&id===generation)onresult([],e)}},
  dispose(){disposed=true;generation++}
 }
}
