/**
 * The `GET /pipelines` answer a fetch-level test needs, built from the same
 * stage rows the test already serves on `GET /lead-stages`. One pipeline, every
 * stage reachable from every other one (a complete transition graph), so a test
 * that moves a lead keeps the behaviour it had before the graph existed.
 *
 * The legacy kind maps onto the pipeline vocabulary the way the API derives it:
 * `conversion` is an `orcamento` stage, `lost` is the `perdido` exit.
 */
type FixtureStage = { id: string; name: string; kind: string; position: number; status?: string };

export function pipelineFixtureFor(stages: readonly FixtureStage[]) {
  const mapped = stages.map((stage) => ({
    id: stage.id,
    name: stage.name,
    position: stage.position,
    type: stage.kind === 'conversion' ? 'orcamento' : 'normal',
    behavior: stage.kind === 'conversion' ? 'opens_orcamentos' : 'none',
    exitKind: stage.kind === 'lost' ? 'perdido' : null,
    requiresReason: stage.kind === 'lost',
    status: stage.status ?? 'active',
  }));
  const transitions = mapped.flatMap((from) =>
    mapped.filter((to) => to.id !== from.id).map((to) => ({ fromStageId: from.id, toStageId: to.id })),
  );
  return {
    pipelines: [
      { id: 'pipe-default', name: 'Vendas padrão', isDefault: true, position: 1, status: 'active', stages: mapped, transitions },
    ],
  };
}
