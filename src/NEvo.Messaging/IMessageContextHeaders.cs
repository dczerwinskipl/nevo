using LanguageExt;

namespace NEvo.Messaging
{
    public interface IMessageContextHeaders : IReadOnlyDictionary<string, string>
    {
        Option<string> CausationId { get; }
        Option<string> CorrelationId { get; }
    }
}