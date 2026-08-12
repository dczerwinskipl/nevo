using LanguageExt;
using static LanguageExt.Prelude;

namespace NEvo.Core;

public static class EitherAsyncExtensions
{
    /// <summary>
    /// Unwraps the common "found or not found" repository-read shape in one step: an
    /// existing <c>Left</c> passes through unchanged (its <c>Some</c>/<c>None</c> is
    /// never evaluated); <c>Right(Some(value))</c> becomes <c>Right(value)</c>;
    /// <c>Right(None)</c> becomes <c>Left</c> via the supplied <paramref name="None"/>
    /// factory.
    /// </summary>
    public static EitherAsync<TLeft, TRight> RequireSome<TLeft, TRight>(
        this EitherAsync<TLeft, Option<TRight>> self,
        Func<TLeft> None
    ) => self.Bind(option => option.Match(
        Some: value => RightAsync<TLeft, TRight>(value),
        None: () => LeftAsync<TLeft, TRight>(None())
    ));
}
