namespace NEvo.Orchestrating;

public enum OrchestrationState
{
    New = 0,
    Running = 1,
    Completed = 2,
    Failed = 3,
    CompensationCompleted = 5,
    CompensationFailed = 6,
}
