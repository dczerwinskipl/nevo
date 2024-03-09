using System.Collections.ObjectModel;
using LanguageExt;

namespace NEvo.Messaging;

public class MessageContextHeaders : ReadOnlyDictionary<string, string>, IMessageContextHeaders
{
    public const string CorrelationIdKey = nameof(CorrelationId);
    public const string CausationIdKey = nameof(CausationId);

    public MessageContextHeaders(IReadOnlyDictionary<string, string> dictionary) : base((IDictionary<string, string>)dictionary)
    {
    }

    public Option<string> CorrelationId => TryGetValue(CorrelationIdKey, out var correlationId) ? correlationId : null;

    public Option<string> CausationId => TryGetValue(CausationIdKey, out var causationId) ? causationId : null;
}
