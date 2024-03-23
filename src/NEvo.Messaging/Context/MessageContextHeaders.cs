using System.Collections.ObjectModel;

namespace NEvo.Messaging.Context;

public class MessageContextHeaders(IDictionary<string, string> dictionary) : ReadOnlyDictionary<string, string>(Check.Null(dictionary)), IMessageContextHeaders
{
    public const string CorrelationIdKey = nameof(CorrelationId);
    public const string CausationIdKey = nameof(CausationId);

    public Option<string> CorrelationId => TryGetValue(CorrelationIdKey, out var correlationId) ? correlationId : null;
    public Option<string> CausationId => TryGetValue(CausationIdKey, out var causationId) ? causationId : null;
}
