namespace NEvo.Messaging.Context;

public interface IMessageContextHeaders : IReadOnlyDictionary<string, string>
{
    Option<string> CausationId { get; }
    Option<string> CorrelationId { get; }
}