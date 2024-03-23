namespace NEvo.Messaging.Context;

public interface IMessageContextHeaders : IDictionary<string, string>
{
    Option<string> CausationId { get; set; }
    Option<string> CorrelationId { get; set; }
}