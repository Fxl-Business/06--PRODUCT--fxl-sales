import * as React from 'react';
import { ChevronDown, LayoutGrid } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { buildLeadStagePath, type SalesOpsWorkspace } from '../navigation';
import { boardStages } from './calculations';
import { useLeadStages } from './hooks';

type Props = {
  workspace: SalesOpsWorkspace;
  activeStageId?: string;
  collapsed: boolean;
  onExpand: () => void;
};

export function LeadSidebarNavigation({ workspace, activeStageId, collapsed, onExpand }: Props) {
  const [expanded, setExpanded] = React.useState(Boolean(activeStageId));
  const visible = !collapsed && (expanded || Boolean(activeStageId));

  return (
    <div>
      <button
        aria-expanded={visible}
        aria-label="Prospecção"
        className={`flex w-full items-center gap-[13px] rounded-xl text-left text-sm font-semibold transition ${collapsed ? 'h-10 w-10 justify-center' : 'px-[13px] py-[11px]'} ${activeStageId ? 'bg-[#f3f3f5] text-[#18181b]' : 'text-[#b3b3bb] hover:bg-white/5 hover:text-white'}`}
        onClick={() => {
          if (collapsed) {
            onExpand();
            setExpanded(true);
          } else setExpanded((value) => !value);
        }}
        type="button"
      >
        <LayoutGrid aria-hidden className="h-[18px] w-[18px] flex-none" />
        {!collapsed && <><span className="min-w-0 flex-1 truncate">Prospecção</span><ChevronDown aria-hidden className={`h-4 w-4 transition-transform ${expanded ? 'rotate-180' : ''}`} /></>}
      </button>
      {visible && (
        <div className="ml-4 border-l border-white/15 pl-2" data-lead-stage-navigation>
          <StageLinks activeStageId={activeStageId} workspace={workspace} />
        </div>
      )}
    </div>
  );
}

function StageLinks({ activeStageId, workspace }: Pick<Props, 'activeStageId' | 'workspace'>) {
  const navigate = useNavigate();
  const stagesQuery = useLeadStages();
  const stages = React.useMemo(() => boardStages(stagesQuery.data ?? []), [stagesQuery.data]);
  return <>
          {stagesQuery.isPending ? <p className="px-3 py-2 text-xs text-[#b3b3bb]">Carregando etapas...</p> :
           stagesQuery.isError ? <p className="px-3 py-2 text-xs text-[#fca5a5]">Não foi possível carregar as etapas.</p> :
           stages.length === 0 ? <p className="px-3 py-2 text-xs text-[#b3b3bb]">Nenhuma etapa ativa.</p> :
           stages.map((stage) => (
             <button
               aria-current={activeStageId === stage.id ? 'page' : undefined}
               aria-label={`Abrir etapa ${stage.name}`}
               className={`block w-full truncate rounded-lg px-3 py-2 text-left text-sm ${activeStageId === stage.id ? 'bg-[#f3f3f5] font-semibold text-[#18181b]' : 'text-[#b3b3bb] hover:bg-white/5 hover:text-white'}`}
               key={stage.id}
               onClick={() => navigate(buildLeadStagePath(workspace, stage.id))}
               type="button"
             >
               {stage.name}
             </button>
           ))}
  </>;
}
