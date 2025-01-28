namespace NEvo.Orchestrating.EntityFramework.Models;

public class OrchestratorStateEf
{
    public Guid Id { get; set; }
    public string OrchestratorType { get; set; } = default!;
    public OrchestratorStatus Status { get; set; }
    public string? LastStep { get; set; }
    public string? LastCompensatedStep { get; set; }
    public string? DataJson { get; set; }
}
