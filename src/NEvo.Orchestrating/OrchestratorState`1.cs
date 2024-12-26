namespace NEvo.Orchestrating;


public class OrchestratorState<TData> : OrchestratorState where TData : new() // should I resign from TData?
{
    public required TData Data { get; set; }
    public override object JsonData { get => Data!; set => Data = (TData)value; }
}
