namespace NEvo.Orchestrating;

public abstract class OrchestratorState
{
    public Guid Id { get; set; }
    public required string OrchestratorType { get; set; }
    public OrchestratorStatus Status { get; set; }
    public string? LastStep { get; set; }
    public string? LastCompensatedStep { get; set; }
    public abstract object JsonData { get; set; }
}
